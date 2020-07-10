
const pidusage = require('pidusage');
const EventEmitter = require('events').EventEmitter;

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
      return inProgressWindow.total / (Date.now() - inProgressWindow.startedAt);
    }

    // Using a complete window have shown to be more accurate
    return completeWindow.total / 1000;
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

function buildShedder({ trigger, minCapacity }) {
  const requestCounter = buildRequestCounter();
  const capacityEstimator = buildCapacityEstimator({ minCapacity })

  function evalRequest() {
    const isTriggered = trigger.hasTriggered();

    if (isTriggered) {
      const requestRate = requestCounter.getRate();
      const capacityOverload = requestRate - capacityEstimator.getCapacity();
      const proportionToDiscard = capacityOverload / requestRate;

      if (Math.random() <= proportionToDiscard) {
        return false;
      }
    } else {
      capacityEstimator.updateCapacity(requestCounter.getRate());

      return true;
    }

    requestCounter.increment();
  }

  return { evalRequest };
}

module.exports = (server, { cpuThreshold, minCapacity }) => {
  const events = new EventEmitter();
  events.on('error', () => {});

  const clientRetrySecs = 10;
  const retryJitter = 60;

  const trigger = buildCPUTrigger(cpuThreshold);
  const loadShedder = buildShedder({ trigger, minCapacity });

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

