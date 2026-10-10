# another_flutter_usb_write (local fork)

Fork of [`another_flutter_usb_write` 1.0.1](https://pub.dev/packages/another_flutter_usb_write)
(last published January 2023, unmaintained). The USB-OTG thermal printer path
in `lib/thermal_receipt.dart` depends on it, and the published version cannot
obtain USB permission on any phone running Android 12 or newer — which is to
say, on nearly every phone this APK is meant to run on.

Dart API is untouched, so `package:another_flutter_usb_write/...` imports and
`FlutterUsbWrite()` usage stay exactly as upstream.

## Why it had to be forked

Both faults are in `acquirePermissions()`, the one function that asks the user
for access to the plugged-in printer. Neither is reachable from Dart, and the
file lives in the shared global pub cache, so neither could be fixed from the
app.

1. **`PendingIntent` with no mutability flag.** Upstream passes `0`. An app
   targeting Android 12+ (API 31) gets `IllegalArgumentException` instead of a
   `PendingIntent`, and `UsbManager.requestPermission()` additionally requires
   the intent to remain *mutable* so the system can attach
   `EXTRA_PERMISSION_GRANTED` to the reply. Fixed by passing
   `FLAG_MUTABLE` on API 31+.
2. **`registerReceiver()` with no export flag.** `ACTION_USB_PERMISSION` is the
   app's own action rather than a protected system broadcast, so Android 14
   (API 34) rejects the registration with a `SecurityException`. Fixed by
   passing `RECEIVER_NOT_EXPORTED` on API 33+.

Either one aborts the permission request before the system dialog is shown. The
Dart side then reports the generic "USB printer se print nahi ho paya", with no
way for the user to grant access and no dialog ever appearing.

## Other changes

- `android/build.gradle`: restructured to match `print_bluetooth_thermal`'s,
  the other printer plugin this app already builds against — declares
  `namespace` (AGP 8 requires it; upstream had none, which the app's root
  `build.gradle` used to inject from outside), `compileSdk 34`, `minSdk 21`,
  explicit Java 8, and an Android Gradle Plugin classpath matching the app's
  8.3.2 from `google()`. Upstream pinned AGP 3.5.0 and resolved it from the
  long-dead `jcenter()`.
- `android/src/main/AndroidManifest.xml`: dropped the `package` attribute, which
  AGP 8 no longer accepts, in favour of the `namespace` above.
- Dropped the iOS stubs, standalone Gradle wrapper and tests — Android-only here.

Licences are upstream's, unchanged: `LICENSE` (MIT, Integrator Dubrovnik) and
`LICENSE_USB_SERIAL` (BSD, Ron Bessems).
