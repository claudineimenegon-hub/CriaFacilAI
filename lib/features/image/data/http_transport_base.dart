typedef ImageHttpResponse = ({int statusCode, String body});

abstract interface class ImageHttpTransport {
  Future<ImageHttpResponse> postJson(Uri uri, String body);
}
