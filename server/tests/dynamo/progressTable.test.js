// The progress table's session reads (S8 D6). The document client is mocked at
// the config boundary so no AWS credentials or network are involved; what is
// asserted is the command each helper sends — the filter expression is the
// contract with DynamoDB, and a wrong one returns an empty page rather than an
// error.

jest.mock('../../src/config/aws', () => ({ getDynamoDocClient: jest.fn() }));

const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { getDynamoDocClient } = require('../../src/config/aws');
const progressTable = require('../../src/dynamo/progressTable');

const send = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  getDynamoDocClient.mockReturnValue({ send });
});

describe('SESSION_PREFIX', () => {
  test('is the sort-key prefix every reader filters on', () => {
    expect(progressTable.SESSION_PREFIX).toBe('session#');
  });
});

describe('scanSessionsSince', () => {
  test('scans for session items that began at or after the given instant', async () => {
    send.mockResolvedValue({ Items: [{ lessonId: 'session#a', durationSec: 10 }] });

    const items = await progressTable.scanSessionsSince('2026-09-01T00:00:00.000Z');

    expect(items).toEqual([{ lessonId: 'session#a', durationSec: 10 }]);
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(ScanCommand);
    expect(command.input).toEqual(
      expect.objectContaining({
        FilterExpression: 'begins_with(lessonId, :p) AND startedAt >= :since',
        ExpressionAttributeValues: { ':p': 'session#', ':since': '2026-09-01T00:00:00.000Z' },
      }),
    );
  });

  test('follows LastEvaluatedKey across pages', async () => {
    send
      .mockResolvedValueOnce({ Items: [{ lessonId: 'session#a' }], LastEvaluatedKey: { k: 1 } })
      .mockResolvedValueOnce({ Items: [{ lessonId: 'session#b' }] });

    const items = await progressTable.scanSessionsSince('2026-09-01T00:00:00.000Z');

    expect(items.map((i) => i.lessonId)).toEqual(['session#a', 'session#b']);
    expect(send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ k: 1 });
  });
});
