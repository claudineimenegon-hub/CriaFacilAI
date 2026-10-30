import 'image_share_service_io.dart'
    if (dart.library.html) 'image_share_service_web.dart'
    as platform;
import 'image_share_service_base.dart';
export 'image_share_service_base.dart';

ImageShareService createImageShareService() =>
    platform.createImageShareService();
