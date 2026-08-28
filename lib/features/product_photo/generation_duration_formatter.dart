String formatGenerationDuration(Duration duration) {
  final totalSeconds = duration.inSeconds;
  final seconds = (totalSeconds % 60).toString().padLeft(2, '0');
  final minutes = ((totalSeconds ~/ 60) % 60).toString().padLeft(2, '0');
  if (totalSeconds < 3600) return '$minutes:$seconds';
  final hours = (totalSeconds ~/ 3600).toString().padLeft(2, '0');
  return '$hours:$minutes:$seconds';
}
