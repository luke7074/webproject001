const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'realprice_user',
  password: '1234',
  database: 'realprice',
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = pool;
