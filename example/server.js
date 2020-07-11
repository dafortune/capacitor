const express = require('express');
const app = express();
const port = 3000;
const capacitor = require('../lib');

const c = capacitor(app, {
  // requestRateThreshold: 5,
  cpuThreshold: 80,
  minCapacity: 10
});

c.events.on('load-shedding-triggered', (a, r) => console.log('load shedding', a/r, `${a}/${r}`));
c.events.on('request-rate', requestRate => console.log('requestRate', requestRate));
c.events.on('trigger:request-rate', requestRate => console.log('trigger:request-rate', requestRate));
c.events.on('trigger:cpu', cpu => console.log('trigger:cpu', cpu));


app.get('/', (req, res) => {
  for (let i = 0; i < 100000000; i++) {}

  res.send('Done!');
});

app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))