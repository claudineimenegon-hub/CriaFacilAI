import 'http_transport_io.dart'
    if (dart.library.html) 'http_transport_web.dart'
    as platform;
import 'http_transport_base.dart';
export 'http_transport_base.dart';

ImageHttpTransport createImageHttpTransport() =>
    platform.createImageHttpTransport();
