import { getIOInstance } from "../sockets/io.instance.js";
import { recoverStaleJobTimers } from "./jobDispatch.service.js";

const JOB_RECOVERY_INTERVAL_MS = Math.max(
  15 * 1000,
  Number.parseInt(process.env.JOB_RECOVERY_INTERVAL_MS || "", 10) || 30 * 1000
);

let recoveryInterval = null;
let recoveryRunning = false;

const emitToRoom = (room, event, payload) => {
  getIOInstance().to(room).emit(event, payload);
};

const runJobRecoveryOnce = async () => {
  if (recoveryRunning) return null;
  recoveryRunning = true;

  try {
    const summary = await recoverStaleJobTimers({ emitToRoom });

    if (summary?.recovered > 0 || summary?.errors > 0) {
      console.log("Job timer recovery summary:", summary);
    }

    return summary;
  } catch (error) {
    console.error("Job timer recovery worker error:", error.message || error);
    return null;
  } finally {
    recoveryRunning = false;
  }
};

const startJobRecoveryWorker = () => {
  if (recoveryInterval) return;

  runJobRecoveryOnce();
  recoveryInterval = setInterval(runJobRecoveryOnce, JOB_RECOVERY_INTERVAL_MS);
};

const stopJobRecoveryWorker = () => {
  if (!recoveryInterval) return;

  clearInterval(recoveryInterval);
  recoveryInterval = null;
};

export { runJobRecoveryOnce, startJobRecoveryWorker, stopJobRecoveryWorker };
