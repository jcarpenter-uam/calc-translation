import { and, eq, isNull } from "drizzle-orm";
import { db } from "../core/database";
import { logger } from "../core/logger";
import { tenants } from "../models/tenantModel";
import { users } from "../models/userModel";

/**
 * Returns the authenticated user profile with tenant details.
 */
export const getMe = async ({ user, tenantId, set }: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [tenant] = tenantId
      ? await db
          .select({
            id: tenants.tenantId,
            name: tenants.organizationName,
          })
          .from(tenants)
          .where(eq(tenants.tenantId, tenantId))
      : [];

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        languageCode: user.languageCode,
      },
      tenant: tenant || null,
    };
  } catch (err) {
    logger.error("Failed to load current user profile.", {
      userId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to fetch current user profile" };
  }
};

/**
 * Updates the authenticated user's language preference.
 */
export const updateMe = async ({ user, body, set }: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [updatedUser] = await db
      .update(users)
      .set({ languageCode: body.languageCode })
      .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        languageCode: users.languageCode,
      });

    if (!updatedUser) {
      set.status = 404;
      return { error: "User not found" };
    }

    logger.info("User language preference updated.", {
      userId,
      languageCode: body.languageCode,
    });

    return {
      message: "Language updated successfully",
      user: updatedUser,
    };
  } catch (err) {
    logger.error("Failed to update current user profile.", {
      userId,
      err,
    });
    set.status = 500;
    return { error: "Failed to update profile" };
  }
};
