// file: testRedis.js
import { createClient } from "redis";

async function main() {
  // สร้าง client
  const redisClient = createClient({
    socket: {
      host: "127.0.0.1",
      port: 6379,
    },
    password: "!cpe66231", // รหัสผ่าน Redis
  });

  redisClient.on("error", (err) => console.log("Redis Error", err));

  await redisClient.connect();

  // ทดสอบ ping
  const pong = await redisClient.ping();
  console.log("Redis response:", pong); // ควรได้ PONG

  // ทดสอบเก็บ OTP
  await redisClient.set("myotp", "123456", { EX: 300 }); // หมดอายุ 5 นาที
  const otp = await redisClient.get("myotp");
  console.log("OTP from Redis:", otp);

  await redisClient.quit();
}

main();
