
const pidusage = require('pidusage');
const EventEmitter = require('events').EventEmitter;

function buildRequestRateTrigger({ threshold, events }) {
  function hasTriggered(requestRate) {
    events.emit('trigger:request-rate', requestRate);

    return requestRate > threshold;
  }

  return {
    hasTriggered
  };
}

function buildCPUTrigger({ threshold, events }) {
  const MAX_DOTS = 10;

  let usageSum = 0;
  let usage = [];
  let recoveryThreshold = threshold * 0.90;
  let isTriggered;
  let triggeredAt;

  setInterval(() => {
    getCPUUsage().then(icpu => {
      if (usage.length >= MAX_DOTS) {
        usageSum -= usage[0];
        usage = usage.slice(1);
      }

      usage.push(icpu);
      usageSum += icpu;
    })
    .catch((err) => {
      console.log('Error getting cpu usage', err);
    });
  }, 500);

  function getCPUUsage() {
    return new Promise((resolve, reject) => {
      pidusage(process.pid, function (err, stats) {
        if (err) {
          return reject(err);
        }

        resolve(stats.cpu);
      });
    });
  }

  function hasTriggered() {
    const cpu = usageSum / usage.length;

    events.emit('trigger:cpu', cpu);

    isTriggered = cpu > threshold || isTriggered && (cpu > recoveryThreshold) || Date.now() < triggeredAt + 1000;

    if (isTriggered) {
      triggeredAt = Date.now();
    }

    return isTriggered;
  }

  return { hasTriggered };
}

function buildRequestCounter() {
  let total;
  let startedAt;

  function resetInProgressWindow() {
    startedAt = Date.now();
    total = 0;
  }

  function increment() {
    if (!startedAt || Date.now() > startedAt + 1000) {
      resetInProgressWindow();
    }

    total += 1;
  }

  function getRate() {
    const now = Date.now();

    if (now - startedAt === 0) {
      return 0;
    }

    return total / ((now - startedAt) / 1000);
  }

  return { increment, getRate };
}

function buildCapacityEstimator({ minCapacity }) {
  const DELAY_MS = 300000;

  const inProgressWindow = {
    capacity: minCapacity,
    startedAt: null
  };

  let capacity = minCapacity;

  function resetInProgressWindow() {
    inProgressWindow.capacity = minCapacity;
    inProgressWindow.startedAt = Date.now();
  }

  function updateCapacity(rate) {
    if (!inProgressWindow.startedAt) {
      resetInProgressWindow();
    } else if (Date.now() > inProgressWindow.startedAt + DELAY_MS) {
      capacity = (capacity + 2 * inProgressWindow.capacity) / 3;
      resetInProgressWindow();
    }

    if (rate > inProgressWindow.capacity) {
      inProgressWindow.capacity = rate;
    }
  }

  function freezeCounter() {
    inProgressWindow.capacity = capacity;
  }

  function getCapacity() {
    return capacity;
  }

  return {
    updateCapacity,
    getCapacity,
    freezeCounter
  };
}

function buildShedder({ trigger, minCapacity, events }) {
  const requestCounter = buildRequestCounter();
  const capacityEstimator = buildCapacityEstimator({ minCapacity })

  function evalRequest() {
    requestCounter.increment();

    const requestRate = requestCounter.getRate();

    const isTriggered = trigger.hasTriggered(requestRate);

    if (isTriggered) {
      // Prevent using capacity from last window that seems to be too much because
      // it has triggered the load shedder
      capacityEstimator.freezeCounter();

      const capacityOverload = requestRate - capacityEstimator.getCapacity();
      const proportionToDiscard = capacityOverload / requestRate;

      if (Math.random() <= proportionToDiscard) {
        result = false;
      }
    } else {
      capacityEstimator.updateCapacity(requestRate);

      result = true;
    }

    events.emit('request-rate', requestRate);

    return result;
  }

  return { evalRequest };
}

module.exports = (server, { requestRateThreshold, cpuThreshold, minCapacity }) => {
  const events = new EventEmitter();
  events.on('error', () => {});

  const clientRetrySecs = 10;
  const retryJitter = 60;

  let trigger;
  if (requestRateThreshold) {
    trigger = buildRequestRateTrigger({
      threshold: requestRateThreshold,
      events
    });
  } else {
    trigger = buildCPUTrigger({
      threshold: cpuThreshold,
      events
    });
  }

  const loadShedder = buildShedder({
    trigger,
    minCapacity,
    events
  });

  let accepted = 0;
  let rejected = 0;

  setInterval(() => {
    if (rejected > 0) {
      events.emit('load-shedding-triggered', accepted, rejected);
    }

    accepted = 0;
    rejected = 0;
  }, 1000);

  server.use((req, res, next) => {
    const reject = !loadShedder.evalRequest();

    if (reject) {
      rejected++;
      res.setHeader('Retry-After', clientRetrySecs + Math.random() * retryJitter)
      res.sendStatus(503);
      return;
    } else {
      accepted++;
    }

    return next();
  });

  return {
    events
  };
};

