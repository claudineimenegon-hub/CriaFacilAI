export class DeterministicProductIdentityAnalyzer {
  constructor({ result, error } = {}) {
    this.result = result;
    this.error = error;
    this.calls = [];
  }

  async analyze(input) {
    this.calls.push(input);
    if (this.error) throw this.error;
    return structuredClone(this.result);
  }
}

