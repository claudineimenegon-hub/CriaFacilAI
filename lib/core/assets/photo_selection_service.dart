import 'photo_selection_service_io.dart'
    if (dart.library.html) 'photo_selection_service_web.dart'
    as platform;
import 'photo_selection_service_base.dart';
export 'photo_selection_service_base.dart';

PhotoSelectionService createPhotoSelectionService() =>
    platform.createPhotoSelectionService();
