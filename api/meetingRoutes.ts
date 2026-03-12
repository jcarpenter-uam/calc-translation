import { Elysia } from "elysia";
import {
  startMeeting,
  joinMeeting,
  endMeeting,
} from "../controllers/meetingController";

export const meetingRoutes = new Elysia({ prefix: "/meeting" })
  .post("/start", startMeeting)
  .post("/join/:id", joinMeeting)
  .post("/end/:id", endMeeting);
