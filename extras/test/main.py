import base64
import subprocess
import sys
import uuid


def run_simultaneously():
    """
    Runs multiple test scripts as separate processes based on user input.
    Odd # streams -> test_1.py
    Even # streams -> test_2.py
    """
    try:
        count_str = input("How many streams to open? ")
        num_streams = int(count_str)
    except ValueError:
        print("Invalid input. Please enter an integer.")
        return

    processes = []

    print(f"--- Starting {num_streams} streams ---")

    for i in range(1, num_streams + 1):
        # Random UUIDs to mimic zoom
        # raw_uuid = uuid.uuid4().bytes
        # session_id = base64.b64encode(raw_uuid).decode("utf-8")

        # Standard 1,2,3... session IDs
        session_id = f"{i}"
        if i % 2 != 0:
            script_path = "./one/test_1.py"
        else:
            script_path = "./two/test_2.py"

        command = [sys.executable, script_path, session_id]
        print(f"[{i}/{num_streams}] Starting: {' '.join(command)}")

        proc = subprocess.Popen(command)
        processes.append(proc)

    print("--- All processes are running ---")
    print("Press Ctrl+C to stop...")

    try:
        for p in processes:
            p.wait()
    except KeyboardInterrupt:
        print("\n--- Stopping processes ---")
        for p in processes:
            p.terminate()

    print("--- All processes have finished ---")


if __name__ == "__main__":
    run_simultaneously()
