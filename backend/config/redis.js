import { createClient } from 'redis';

const redisClient = createClient({
  socket: {
    host: '127.0.0.1', 
    port: 6379
  },
  password:process.env.REDIS_PASSWORD,
});

redisClient.on('connect', () => {
  console.log('Connected to Redis');
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

await redisClient.connect();

export default redisClient;
