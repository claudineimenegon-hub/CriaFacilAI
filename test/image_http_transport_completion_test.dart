import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/features/image/data/http_transport.dart';

void main() {
  test('load conclui a Future uma única vez', () async {
    final completion = ImageHttpRequestCompletion();
    completion.succeed((statusCode: 200, body: '{}'));
    completion.fail(ImageHttpFailure.network);

    expect(await completion.future, (statusCode: 200, body: '{}'));
  });

  for (final failure in ImageHttpFailure.values) {
    test('$failure conclui a Future com erro Dart controlado', () async {
      final completion = ImageHttpRequestCompletion();
      completion.fail(failure);

      await expectLater(
        completion.future,
        throwsA(
          isA<ImageHttpTransportException>()
              .having((error) => error.failure, 'failure', failure)
              .having(
                (error) => error.message.contains('ProgressEvent'),
                'não expõe ProgressEvent',
                false,
              ),
        ),
      );
      expect(completion.isCompleted, isTrue);
    });
  }
}
