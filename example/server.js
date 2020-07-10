const express = require('express');
const app = express();
const port = 3000;
const capacitor = require('../lib');

capacitor(app, {
  cpuThreshold: 50,
  minCapacity: 10000
});

app.get('/', (req, res) => {
  for (let i = 0; i < 100000000; i++) {}

  res.send('Done!');
});

app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))