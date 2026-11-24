const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../config/db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

// 1. 메인 장터 목록 (카테고리, 거래상태, 키워드 검색)
router.get('/', async (req, res) => {
  const { category = '전체', status = '전체', keyword = '' } = req.query;
  try {
    let sql = `
      SELECT p.*, u.nickname, u.region,
        (SELECT COUNT(*) FROM comments c WHERE c.product_id = p.product_id) AS comment_count,
        (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.product_id) AS wish_count
      FROM products p
      JOIN users u ON p.user_id = u.user_id
      WHERE 1=1
    `;
    const params = [];

    if (category !== '전체') {
      sql += ' AND p.category = ?';
      params.push(category);
    }
    if (status !== '전체') {
      sql += ' AND p.status = ?';
      params.push(status);
    }
    if (keyword.trim() !== '') {
      sql += ' AND (p.title LIKE ? OR p.model_name LIKE ?)';
      params.push(`%${keyword.trim()}%`, `%${keyword.trim()}%`);
    }

    sql += ' ORDER BY p.created_at DESC';
    const [products] = await db.query(sql, params);

    res.render('index', { products, category, status, keyword });
  } catch (err) {
    console.error(err);
    res.status(500).send('목록 조회 오류');
  }
});

// 2. 모델별 실시간 시세 분석표 (추가 독창 기능)
router.get('/prices', async (req, res) => {
  try {
    const [stats] = await db.query(`
      SELECT 
        MAX(model_name) AS model_name,
        MAX(category) AS category,
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = '판매중' THEN 1 ELSE 0 END) AS active_count,
        ROUND(AVG(price)) AS avg_price,
        MIN(price) AS min_price,
        MAX(price) AS max_price
      FROM products
      GROUP BY REPLACE(model_name, ' ', '')
      ORDER BY total_count DESC, avg_price DESC
    `);
    res.render('prices', { stats });
  } catch (err) {
    console.error(err);
    res.status(500).send('시세 조회 오류');
  }
});

// 3. 내 찜 목록
router.get('/my-wishes', requireLogin, async (req, res) => {
  try {
    const [products] = await db.query(`
      SELECT p.*, u.nickname, u.region
      FROM wishlists w
      JOIN products p ON w.product_id = p.product_id
      JOIN users u ON p.user_id = u.user_id
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `, [req.session.user.user_id]);
    res.render('my_wishes', { products });
  } catch (err) {
    console.error(err);
    res.status(500).send('찜 목록 조회 오류');
  }
});

// 4. 매물 등록 페이지 및 처리
router.get('/products/new', requireLogin, (req, res) => {
  res.render('write');
});

router.post('/products/new', requireLogin, upload.single('image'), async (req, res) => {
  const { category, model_name, title, price, condition_grade, content } = req.body;
  const image_path = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    await db.query(
      `INSERT INTO products (user_id, category, model_name, title, price, condition_grade, content, image_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.session.user.user_id, category, model_name.trim(), title.trim(), Number(price), condition_grade, content, image_path]
    );
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('매물 등록 오류');
  }
});

// 5. 매물 상세 페이지 + 동일 모델 실시간 시세 자동 분석
router.get('/products/:id', async (req, res) => {
  const productId = req.params.id;
  try {
    await db.query('UPDATE products SET views = views + 1 WHERE product_id = ?', [productId]);

    const [rows] = await db.query(`
      SELECT p.*, u.nickname, u.region
      FROM products p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.product_id = ?
    `, [productId]);

    if (rows.length === 0) return res.status(404).send('존재하지 않는 매물입니다.');
    const product = rows[0];

    // 공백 제거 정규화 후 동일 모델 평균/최저/최고가 계산
    const [priceRows] = await db.query(`
      SELECT 
        COUNT(*) AS sample_count,
        ROUND(AVG(price)) AS avg_price,
        MIN(price) AS min_price,
        MAX(price) AS max_price
      FROM products
      WHERE REPLACE(model_name, ' ', '') = REPLACE(?, ' ', '')
    `, [product.model_name]);

    const marketStat = priceRows[0];

    const [comments] = await db.query(`
      SELECT c.*, u.nickname
      FROM comments c
      JOIN users u ON c.user_id = u.user_id
      WHERE c.product_id = ?
      ORDER BY c.created_at ASC
    `, [productId]);

    let isWished = false;
    if (req.session.user) {
      const [wishRows] = await db.query(
        'SELECT * FROM wishlists WHERE user_id = ? AND product_id = ?',
        [req.session.user.user_id, productId]
      );
      isWished = wishRows.length > 0;
    }

    res.render('detail', { product, marketStat, comments, isWished });
  } catch (err) {
    console.error(err);
    res.status(500).send('상세 조회 오류');
  }
});

// 6. 거래 상태 변경 (판매중 / 예약중 / 거래완료)
router.post('/products/:id/status', requireLogin, async (req, res) => {
  const { status } = req.body;
  try {
    await db.query(
      'UPDATE products SET status = ? WHERE product_id = ? AND user_id = ?',
      [status, req.params.id, req.session.user.user_id]
    );
    res.redirect(`/products/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('상태 변경 오류');
  }
});

// 7. 매물 수정 & 삭제
router.get('/products/:id/edit', requireLogin, async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM products WHERE product_id = ? AND user_id = ?',
    [req.params.id, req.session.user.user_id]
  );
  if (rows.length === 0) return res.status(403).send('수정 권한이 없습니다.');
  res.render('edit', { product: rows[0] });
});

router.post('/products/:id/edit', requireLogin, async (req, res) => {
  const { category, model_name, title, price, condition_grade, content } = req.body;
  await db.query(
    `UPDATE products SET category=?, model_name=?, title=?, price=?, condition_grade=?, content=?
     WHERE product_id=? AND user_id=?`,
    [category, model_name.trim(), title.trim(), Number(price), condition_grade, content, req.params.id, req.session.user.user_id]
  );
  res.redirect(`/products/${req.params.id}`);
});

router.post('/products/:id/delete', requireLogin, async (req, res) => {
  await db.query(
    'DELETE FROM products WHERE product_id = ? AND user_id = ?',
    [req.params.id, req.session.user.user_id]
  );
  res.redirect('/');
});

// 8. 댓글 등록 & 삭제
router.post('/products/:id/comments', requireLogin, async (req, res) => {
  const { content } = req.body;
  if (content && content.trim() !== '') {
    await db.query(
      'INSERT INTO comments (product_id, user_id, content) VALUES (?, ?, ?)',
      [req.params.id, req.session.user.user_id, content.trim()]
    );
  }
  res.redirect(`/products/${req.params.id}`);
});

router.post('/comments/:id/delete', requireLogin, async (req, res) => {
  const { product_id } = req.body;
  await db.query(
    'DELETE FROM comments WHERE comment_id = ? AND user_id = ?',
    [req.params.id, req.session.user.user_id]
  );
  res.redirect(`/products/${product_id}`);
});

// 9. 관심 매물 찜하기 토글 (N:M 매핑 테이블 활용)
router.post('/products/:id/wish', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const productId = req.params.id;
  const [exists] = await db.query(
    'SELECT * FROM wishlists WHERE user_id = ? AND product_id = ?',
    [userId, productId]
  );
  if (exists.length > 0) {
    await db.query('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?', [userId, productId]);
  } else {
    await db.query('INSERT INTO wishlists (user_id, product_id) VALUES (?, ?)', [userId, productId]);
  }
  res.redirect(`/products/${productId}`);
});

module.exports = router;
