'use strict';
const { getCategory, getAll } = require('../lib/aggregator');

function setCommon(res) {
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
}

module.exports = async function handler(req, res) {
  const cat = String((req.query && req.query.cat) || 'ai').toLowerCase();
  try {
    let data;
    if (cat === 'all') data = await getAll();
    else if (cat === 'ai' || cat === 'security') data = await getCategory(cat);
    else {
      setCommon(res);
      res.status(400).json({ ok: false, error: 'cat must be ai | security | all' });
      return;
    }
    setCommon(res);
    res.status(200).json(data);
  } catch (err) {
    setCommon(res);
    res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
};
