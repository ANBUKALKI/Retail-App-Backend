const { Server } = require('socket.io');
const config = require('./config');
const { userFromToken } = require('./middleware/auth');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const user = await userFromToken(socket.handshake.auth && socket.handshake.auth.token);
      socket.user = user;
      next();
    } catch (e) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user._id}`);
    socket.join(`role:${socket.user.role}`);
  });

  return io;
}

module.exports = { initSocket };

//=========== 29-10-26 =============

// const { Server } = require('socket.io');
// const config = require('./config');
// const { userFromToken } = require('./middleware/auth');

// function initSocket(httpServer) {
//   const io = new Server(httpServer, {
//     cors: { origin: config.clientOrigins, credentials: true },
//   });

//   io.use(async (socket, next) => {
//     try {
//       const user = await userFromToken(socket.handshake.auth && socket.handshake.auth.token);
//       socket.user = user;
//       next();
//     } catch (e) {
//       next(new Error('unauthorized'));
//     }
//   });

//   io.on('connection', (socket) => {
//     socket.join(`user:${socket.user._id}`);
//     socket.join(`role:${socket.user.role}`);
//   });

//   return io;
// }

// module.exports = { initSocket };
