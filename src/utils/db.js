import util from 'util';
import mysql from 'mysql';
// import mysql from 'promise-mysql';
const config = {
  host: '128.199.130.160',
  user: 'rimna-dev',
  password: '@rimna!',
  database: 'rimna_db',
  port: '3306',
  connectionLimit: 100,
};

let pool = mysql.createPool(config);

pool.getConnection((err, connection) => {
  if (err) {
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      console.error('Database connection was closed.');
    }
    if (err.code === 'ER_CON_COUNT_ERROR') {
      console.error('Database has too many connections.');
    }
    if (err.code === 'ECONNREFUSED') {
      console.error('Database connection was refused.');
    }
  }

  if (connection) connection.release();

  return;
});

pool.query = util.promisify(pool.query);
export default pool;