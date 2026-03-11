import { Elysia } from "elysia";
import {
  startMeeting,
  joinMeeting,
  endMeeting,
} from "../controllers/meetingControllers";

export const meetingRoutes = new Elysia()
  // HTTP Endpoints
  .post("/start", startMeeting)
  .post("/join/:id", joinMeeting)
  .post("/end/:id", endMeeting);
