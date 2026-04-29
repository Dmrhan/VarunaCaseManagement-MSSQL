import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ value: [], '@odata.count': 0, note: 'FAZ 0 — BFF iskelet, gerçek veri henüz yok.' });
});

router.get('/:id', (req, res) => {
  res.status(404).json({ error: 'not implemented', id: req.params.id });
});

router.post('/', (_req, res) => {
  res.status(501).json({ error: 'not implemented' });
});

router.patch('/:id', (req, res) => {
  res.status(501).json({ error: 'not implemented', id: req.params.id });
});

export default router;
