import 'asset_http_transport_io.dart'
    if (dart.library.html) 'asset_http_transport_web.dart'
    as platform;
import 'asset_http_transport_base.dart';
export 'asset_http_transport_base.dart';

AssetHttpTransport createAssetHttpTransport() =>
    platform.createAssetHttpTransport();
