#!/bin/bash

# Configuration
PACKAGE_NAME="host.exp.exponent" # Expo Go
DB_NAME="audiobook_v2.db"
PROJECT_ASSETS_DIR="$(pwd)/assets"
OUTPUT_FILE="$PROJECT_ASSETS_DIR/audiobook-prebuilt.db"

# Find ADB
ADB_BIN=$(which adb)
if [ -z "$ADB_BIN" ]; then
    # Common locations
    POSSIBLE_ADB=(
        "$HOME/Android/Sdk/platform-tools/adb"
        "/usr/bin/adb"
        "/usr/local/bin/adb"
        "/opt/android-sdk/platform-tools/adb"
    )
    for path in "${POSSIBLE_ADB[@]}"; do
        if [ -f "$path" ]; then
            ADB_BIN="$path"
            break
        fi
    done
fi

if [ -z "$ADB_BIN" ]; then
    echo "Error: 'adb' command not found."
    echo "Please install Android Platform Tools or add it to your PATH."
    echo "On Ubuntu/Debian: sudo apt install android-tools-adb"
    exit 1
fi

echo "Using adb at: $ADB_BIN"

# Proactive: restart adb server if no devices are found
INITIAL_CHECK=$($ADB_BIN devices | grep -v "List of devices connected" | grep "device$" | wc -l)
if [ "$INITIAL_CHECK" -eq 0 ]; then
    echo "No devices found. Restarting adb server..."
    $ADB_BIN kill-server
    $ADB_BIN start-server
    sleep 2
fi

# Check for connected devices again
DEVICES=$($ADB_BIN devices | grep -v "List of devices connected" | grep -v "^$")
DEVICE_COUNT=$(echo "$DEVICES" | grep "device$" | wc -l)
UNAUTHORIZED_COUNT=$(echo "$DEVICES" | grep "unauthorized$" | wc -l)

if [ "$DEVICE_COUNT" -eq 0 ]; then
    echo "------------------------------------------------"
    echo "DIAGNOSTICS:"
    echo "1. ADB Version: $($ADB_BIN version | head -n 1)"
    echo "2. Connected USB Devices (lsusb):"
    lsusb 2>/dev/null | grep -i "Google\|Samsung\|Xiaomi\|Android" || echo "   (No common Android hardware detected on USB)"
    echo "3. Unauthorized Devices: $UNAUTHORIZED_COUNT"
    echo "------------------------------------------------"

    echo "Error: No authorized devices/emulators found."

    if [ "$UNAUTHORIZED_COUNT" -gt 0 ]; then
        echo ">>> DETECTION: You have an UNAUTHORIZED device."
        echo ">>> ACTION: Check your phone's screen NOW and tap 'ALLOW' for USB Debugging."
    else
        echo ">>> ACTION: Follow these steps to fix:"
        echo "    a) Unplug and replug the USB cable."
        echo "    b) Try a DIFFERENT USB cable (some cables only support charging, not data)."
        echo "    c) Ensure 'USB Debugging' is ON (Settings > Developer Options)."
        echo "    d) (Linux) You may need to run: sudo adb devices"
        echo "    e) (Linux) Check if udev rules are missing."
        echo ""
        echo ">>> ALTERNATIVE (Recommended):"
        echo "    Vì bạn đang dùng Expo, cách nhanh nhất là dùng tính năng 'Hidden Export' tôi vừa cài:"
        echo "    Dùng ngón tay NHẤN GIỮ (Long Press) vào tiêu đề 'Thư viện' trên điện thoại."
        echo "    Nó sẽ mở bảng Share để bạn gửi file qua Zalo/Email ngay lập tức!"
    fi
    exit 1
elif [ "$DEVICE_COUNT" -gt 1 ]; then
    echo "Warning: Multiple devices found. Using the first one."
    DEVICE_ID=$(echo "$DEVICES" | grep "device$" | head -n 1 | awk '{print $1}')
    ADB_CMD="$ADB_BIN -s $DEVICE_ID"
else
    ADB_CMD="$ADB_BIN"
fi

echo "Attempting to pull database from $PACKAGE_NAME..."

# Ensure assets directory exists
mkdir -p "$PROJECT_ASSETS_DIR"

# Export Database
echo "Exporting database (including audio BLOBs)..."
$ADB_CMD exec-out run-as $PACKAGE_NAME cat "files/SQLite/$DB_NAME" > "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
    echo "------------------------------------------------"
    echo "SUCCESSFUL EXPORT!"
    echo "Database: assets/audiobook-prebuilt.db ($(du -h "$OUTPUT_FILE" | cut -f1))"
    echo "------------------------------------------------"
    echo "Everything (including synthesized audio) is now in one file."
else
    echo "Failed to pull using run-as. Trying secondary location..."
    # Root-based approach for some emulators
    $ADB_CMD pull "/data/data/$PACKAGE_NAME/files/SQLite/$DB_NAME" "$OUTPUT_FILE" 2>/dev/null

    if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
        echo "Successfully exported database (root method) to: $OUTPUT_FILE"
    else
        echo "Error: Could not pull the database. Possible reasons:"
        echo "1. Device/Emulator not connected (run 'adb devices')"
        echo "2. App not running or not debuggable"
        echo "3. Path mismatch (check your app's FileSystem.documentDirectory)"
        rm -f "$OUTPUT_FILE"
        exit 1
    fi
fi
