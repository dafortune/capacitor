# Capacitor (WIP: WARNING! DO NOT USE)
Capacitor is a load shedding engine with integrated QoS and fairness. It allows us to continuosly monitor a set of metrics about the capacity of our system and react to them in real time to keep system load controlled by rejecting traffic that would otherwise kill the service.

Capacitor is designed for multitenancy services, keeping fairness as one of the main objetives

### Usage
```js
const capacitor = require('capacitor');

const server = capacitor(expressServer);

server.get('...').loadShedding({
  flowPosition: capacitor.FLOW_POSITION.START,
  endpointClass: capacitor.ENDPOINT_CLASS.BUSINESS_CRITICAL,
  directCost: capacitor.COST_CLASSES.LOW
});

const shedder = capacitor.build({
  limits: {
    cpu: {
      softLimit: 0.75,
      hardLimit: 0.8
      fn: capacitor.cost.cpu
    },
    eventLoop: {
      softLimit: 100,
      hardLimit: 150,
      fn: capacitor.cost.eventLoopLag
    }
  },

  opportunityCost: (reqData) => {
    // Example /test endpoint from LB
    if (reqData.endpointClass === capacitor.ENDPOINT_CLASS.INFRA_CRITICAL) {
      return capacitor.COST_CLASSES.EXTREMELY_HIGH;
    }

    if (reqData.payingTier === 'enterprice' && reqData.usageTier === 'production') {
      if (reqData.endpointClass === capacitor.ENDPOINT_CLASS.BUSINESS_CRITICAL) {
        return reqData.entityRPS < 100 ? capacitor.COST_CLASSES.HIGH : capacitor.COST_CLASSES.MEDIUM;
      }

      // If we have started an operation better to finish it than having the user
      // retry the whole flow adding more load to the system
      if (reqData.flowPosition === capacitor.FLOW_POSITION.INTERMEDIATE) {
        return capacitor.COST_CLASSES.MEDIUM;
      }

      return capacitor.COST_CLASSES.LOW;
    }

    return capacitor.COST_CLASSES.LOW;
  }

  directCost: (reqData) => {
    return reqData.requestDirectCost;
  },

  resolveEntity: (reqData) => {
    return reqData.tenant;
  },

  fairnessLimit: 0.10,

  requestClassifier: (directCost, oportunityCost) => {
    if (oportunityCost > directCost) {
      return capacitor.REQUEST_CLASSES.HIGH;
    }

    if (oportunityCost === directCost) {
      return capacitor.REQUEST_CLASSES.MEDIUM;
    }

    if (oportunityCost < directCost) {
      return capacitor.REQUEST_CLASSES.LOW;
    }
  }
});
```


