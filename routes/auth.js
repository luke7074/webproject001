const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { login_id, password } = req.body;
  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE login_id = ? AND password = ?',
      [login_id, password]
    );
    if (rows.length === 0) {
      return res.render('login', { error: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }
    req.session.user = {
      user_id: rows[0].user_id,
      login_id: rows[0].login_id,
      nickname: rows[0].nickname,
      region: rows[0].region
    };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('로그인 처리 중 오류가 발생했습니다.');
  }
});

router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

router.post('/register', async (req, res) => {
  const { login_id, password, nickname, region } = req.body;
  try {
    await db.query(
      'INSERT INTO users (login_id, password, nickname, region) VALUES (?, ?, ?, ?)',
      [login_id, password, nickname, region || '인천 미추홀구']
    );
    res.redirect('/auth/login');
  } catch (err) {
    console.error(err);
    res.render('register', { error: '이미 사용 중인 아이디이거나 입력값이 올바르지 않습니다.' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
