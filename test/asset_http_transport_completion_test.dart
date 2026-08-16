import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/assets/data/asset_http_transport.dart';

void main() {
  test('onLoad conclui Future uma única vez', () async {
    final completion = AssetHttpRequestCompletion();
    completion.succeed((statusCode: 201, body: '{}'));
    completion.fail(AssetHttpFailure.network);

    expect(await completion.future, (statusCode: 201, body: '{}'));
  });

  for (final failure in AssetHttpFailure.values) {
    test('$failure conclui Future com erro sanitizado', () async {
      final completion = AssetHttpRequestCompletion();
      completion.fail(failure);

      await expectLater(
        completion.future,
        throwsA(
          isA<AssetHttpTransportException>()
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
