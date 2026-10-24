// Records returned by tools during one run. The validator only accepts
// citations of records in this registry (SPEC 8: ids must come from this run).

export type EvidenceRecord = Record<string, unknown> & {
  id: string;
  clientId: string;
};

export class EvidenceRegistry {
  private readonly records = new Map<string, EvidenceRecord>();

  constructor(readonly clientId: string) {}

  add(record: EvidenceRecord) {
    if (record.clientId !== this.clientId) {
      throw new Error(`record ${record.id} belongs to another client`);
    }
    this.records.set(record.id, record);
  }

  get(id: string): EvidenceRecord | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  ids(): string[] {
    return [...this.records.keys()];
  }
}
