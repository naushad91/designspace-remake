import { WebSocket, WebSocketServer } from 'ws';
import jwt from "jsonwebtoken";
import { JWT_SECRET } from '@repo/backend-common/config';
import { prismaClient } from '@repo/db/client';

const wss = new WebSocketServer({ port: 8080 });

interface User {
  ws: WebSocket;
  rooms: string[];
  userId: string;
}

const users: User[] = [];

// ✅ Token verification
function checkUser(token: string): string | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    return typeof decoded === "string" || !decoded?.userId ? null : decoded.userId;
  } catch {
    return null;
  }
}

// ✅ Connection handling
wss.on('connection', (ws, request) => {
  const url = request.url;
  if (!url) {
    ws.close();
    return;
  }

  const queryParams = new URLSearchParams(url.split('?')[1]);
  const token = queryParams.get('token') || "";
  const userId = checkUser(token);

  if (!userId) {
    ws.close();
    return;
  }

  users.push({ userId, rooms: [], ws });
  console.log(`✅ User ${userId} connected`);

  // ✅ Handle incoming messages
  ws.on('message', async (data) => {
    let parsedData;
    try {
      parsedData = JSON.parse(typeof data === "string" ? data : data.toString());
    } catch (e) {
      console.error("❌ Invalid JSON:", data);
      return;
    }

    console.log("📩 Message received:", parsedData);

    const user = users.find(u => u.ws === ws);
    if (!user) {
      console.error("❌ User not found for this WebSocket");
      return;
    }

    const type = parsedData.type;
    const roomId = String(parsedData.roomId || "");
    const message = parsedData.message;

    if (type === "join_room") {
      if (!user.rooms.includes(roomId)) {
        user.rooms.push(roomId);
        console.log(`🔗 User ${user.userId} joined room ${roomId}`);
      }
    }

    if (type === "leave_room") {
      user.rooms = user.rooms.filter(r => r !== roomId);
      console.log(`🚪 User ${user.userId} left room ${roomId}`);
    }

    if (type === "chat") {
      if (!roomId || !message) {
        console.warn("❗ Missing roomId or message in chat payload");
        return;
      }

      // ✅ Save chat in database
      await prismaClient.chat.create({
        data: {
          roomId: Number(roomId),
          message,
          userId
        }
      });

      // ✅ Broadcast to users in room
      users.forEach(u => {
        if (u.rooms.includes(roomId)) {
          u.ws.send(JSON.stringify({
            type: "chat",
            message,
            roomId
          }));
        }
      });
    }
  });

  // ✅ Cleanup disconnected users
  ws.on("close", () => {
    const index = users.findIndex(u => u.ws === ws);
    if (index !== -1) {
        //@ts-ignore
      console.log(`❌ User ${users[index].userId} disconnected`);
      users.splice(index, 1);
    }
  });
});
