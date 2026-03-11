import { Elysia } from "elysia";

export const meetingRoutes = new Elysia()

  // Start endpoint
  .post("/start", () => ({ message: `Started meeting` }))
  // Join endpoint
  .post("/join", () => ({ message: `Joined meeting` }))
  // End endpoint
  .post("/end", () => ({ message: `Ended meeting` }));
