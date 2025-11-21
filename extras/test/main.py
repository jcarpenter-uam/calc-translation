import subprocess
import sys
import time


def run_simultaneously():
    """
    Runs both test scripts as separate processes.
    """
    command_1 = [sys.executable, "./one/test_1.py"]
    command_2 = [sys.executable, "./two/test_2.py"]

    print(f"--- Starting: {' '.join(command_1)} ---")
    proc_1 = subprocess.Popen(command_1)

    print(f"--- Starting: {' '.join(command_2)} ---")
    proc_2 = subprocess.Popen(command_2)

    print("--- Both processes are running ---")
    print("Press Ctrl+C to stop...")

    try:
        proc_1.wait()
        proc_2.wait()
    except KeyboardInterrupt:
        print("\n--- Stopping processes ---")
        proc_1.terminate()
        proc_2.terminate()

    print("--- Both processes have finished ---")


if __name__ == "__main__":
    run_simultaneously()
