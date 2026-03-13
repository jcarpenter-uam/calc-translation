import { Elysia } from "elysia";
import {
  createMeeting,
  joinMeeting,
  endMeeting,
} from "../controllers/meetingController";

export const meetingRoutes = new Elysia({ prefix: "/meeting" })
  .post("/create", createMeeting)
  .post("/join/:id", joinMeeting)
  .post("/end/:id", endMeeting);
