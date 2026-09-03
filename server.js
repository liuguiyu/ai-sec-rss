'use strict';
// Render / 本机运行：Express 服务，同时托管静态页
const express = require('express');
const path = require('path');
const { getCategory, getAll } = require('./lib/aggregator');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/static', express.static(path.join(__dirname, 'static')));

app.get('/api/feeds', async (req, res) => {
  const cat = String(req.query.cat || 'ai').toLowerCase();
  try {
    let data;
    if (cat === 'all') data = await getAll();
    else if (cat === 'ai' || cat === 'security') data = await getCategory(cat);
    else {
      res.status(400).json({ ok: false, error: 'cat must be ai | security | all' });
      return;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

app.get('/api/feeds/list', (req, res) => {
  res.json(require('./feeds.json'));
});

app.listen(PORT, () => console.log('AI&Sec RSS listening on http://localhost:' + PORT));
