#!/bin/bash
# Creates and opens the iOS app project. Run on a Mac with Xcode 16+. Works from any directory.
# Uses Swift Package Manager, so CocoaPods is NOT required.
set -e
cd "$(dirname "$0")/.."
npm install
if [ ! -d ios/App/App.xcodeproj ]; then
  rm -rf ios
  # 'cap add' may print a CocoaPods/Podfile error on SPM projects; the project is still created.
  npx cap add ios --packagemanager SPM || true
fi
[ -d ios/App/App.xcodeproj ] || { echo "iOS project was not created - see errors above."; exit 1; }
npx cap sync ios
PL=ios/App/App/Info.plist
add() { /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PL"; }
add NSCameraUsageDescription "Particle Field photographs the calibration tray to measure particle sizes."
add NSPhotoLibraryUsageDescription "Import photos of the calibration tray to measure particle sizes."
add NSLocationWhenInUseUsageDescription "Optionally tags a sample with where it was collected."
open ios/App/App.xcodeproj
echo
echo "In Xcode: App target > Signing & Capabilities > pick your Team, choose your iPhone as the run destination, press Run."
