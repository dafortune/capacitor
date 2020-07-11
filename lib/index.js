
const pidusage = require('pidusage');
const EventEmitter = require('events').EventEmitter;

function buildRequestRateTrigger(threshold) {
  function hasTriggered(requestRate) {
    return requestRate > threshold;
  }

  return {
    hasTriggered
  };
}

function buildCPUTrigger(threshold) {
  const MAX_DOTS = 10;

  let usageSum = 0;
  let usage = [];

  setInterval(() => {
    if (usage.length > MAX_DOTS) {
      usageSum -= usage[0];
      usage = usage.slice(1);
    }

    getCPUUsage().then(icpu => {
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
    return usageSum / usage.length > threshold;
  }

  return { hasTriggered };
}

function buildRequestCounter() {
  let inProgressWindow = {
    total: 0,
    startedAt: null
  };

  let completeWindow = null;

  function resetInProgressWindow() {
    inProgressWindow.startedAt = Date.now();
    inProgressWindow.total = 0;
  }

  function increment() {
    if (!inProgressWindow.startedAt) {
      resetInProgressWindow();
    } else if (Date.now() > inProgressWindow.startedAt + 1000) {
      completeWindow = inProgressWindow;
      resetInProgressWindow();
    }

    inProgressWindow.total += 1;
  }

  function getRate() {
    // At the beggining
    if (!completeWindow) {
      return inProgressWindow.total / ((Date.now() - inProgressWindow.startedAt) / 1000);
    }

    // Using a complete window have shown to be more accurate
    return completeWindow.total;
  }

  return { increment, getRate };
}

function buildCapacityEstimator({ minCapacity }) {
  const DELAY_MS = 120000;

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
      capacity = Math.max(capacity, inProgressWindow.capacity);
      resetInProgressWindow();
    }

    if (rate > inProgressWindow.capacity) {
      inProgressWindow.capacity = rate;
    }
  }

  function getCapacity() {
    return capacity;
  }

  return {
    updateCapacity,
    getCapacity
  };
}

function buildShedder({ trigger, minCapacity, events }) {
  const requestCounter = buildRequestCounter();
  const capacityEstimator = buildCapacityEstimator({ minCapacity })

  function evalRequest() {
    const requestRate = requestCounter.getRate();

    const isTriggered = trigger.hasTriggered(requestRate);

    if (isTriggered) {
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

    requestCounter.increment();

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
    trigger = buildRequestRateTrigger(requestRateThreshold);
  } else {
    trigger = buildCPUTrigger(cpuThreshold);
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

