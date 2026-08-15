abstract final class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL');

  static bool get hasApiBaseUrl => apiBaseUrl.trim().isNotEmpty;
}
