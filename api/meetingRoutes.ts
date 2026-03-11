import { Elysia } from "elysia";
import {
  startMeeting,
  joinMeeting,
  endMeeting,
} from "../controller/meetingControllers";

export const meetingRoutes = new Elysia()

  // Start endpoint
  .post("/start", startMeeting)

  // Join endpoint
  .post("/join", joinMeeting)

  // End endpoint
  .post("/end", endMeeting);
