import { websocketController } from "./websocketControllers";
import { logger } from "../core/logger";

export const startMeeting = async ({ set }: { set: any }) => {
  // Generate a unique ID (e.g., 'meeting-7d2a-4b91')
  const generatedId = `meeting-${crypto.randomUUID().split("-")[0]}`;

  // Check for collisions
  if (websocketController.getMeeting(generatedId)) {
    set.status = 409;
    return { error: "Collision detected, please try again" };
  }

  const session = websocketController.createMeeting(generatedId);
  await session.connect();

  logger.debug(`Meeting '${generatedId}' started`);

  return {
    message: "Meeting started successfully",
    id: generatedId,
  };
};

export const joinMeeting = async ({
  params,
  set,
}: {
  params: { id: string };
  set: any;
}) => {
  const meeting = websocketController.getMeeting(params.id);

  if (!meeting) {
    set.status = 404;
    return { error: "Meeting not found" };
  }

  // NOTE: Generate a dummy token
  const mockToken = `token_${Math.random().toString(36).substring(7)}`;

  logger.debug(`User <id> joined meeting '${params.id}'`);

  return {
    message: "Joined successfully",
    meetingId: params.id,
    token: mockToken,
  };
};

export const endMeeting = async ({
  params,
  set,
}: {
  params: { id: string };
  set: any;
}) => {
  const meeting = websocketController.getMeeting(params.id);

  if (!meeting) {
    set.status = 404;
    return { error: "Meeting not found" };
  }

  try {
    // Signal the end of the transcription session to Soniox
    await meeting.sonioxSession.finish();
  } catch (err) {
    logger.error("Error finishing Soniox session:", err);
  }

  // Clear from memory and notify participants
  websocketController.deleteMeeting(params.id);

  logger.debug(`User <id> ended meeting '${params.id}'`);

  return { message: `Meeting ${params.id} ended` };
};
