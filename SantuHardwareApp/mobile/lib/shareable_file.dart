import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Where to write a file that will be handed to Share.shareXFiles().
///
/// share_plus copies whatever path you give it into its OWN cache folder
/// (`<cacheDir>/share_plus/`) before vending it through its FileProvider —
/// and its Share.kt explicitly REJECTS a path that is already inside that
/// folder ("Shared file can not be located in '.../cache/share_plus'"),
/// because that folder is wiped by its own clearShareCacheFolder() and
/// reserved for its internal copy. So a file to share must be written
/// anywhere else — ordinarily just the app's plain temp directory.
Future<File> shareableFile(String filename) async {
  final dir = await getTemporaryDirectory();
  return File('${dir.path}/$filename');
}
