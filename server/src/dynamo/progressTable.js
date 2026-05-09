const { GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { getDynamoDocClient } = require('../config/aws');
const { env } = require('../config/env');

const TABLE = env.aws.dynamo.progressTable;

const getProgress = async (userId, lessonId) => {
  const client = getDynamoDocClient();
  const result = await client.send(
    new GetCommand({ TableName: TABLE, Key: { userId, lessonId } }),
  );
  return result.Item || null;
};

const putProgress = async (item) => {
  const client = getDynamoDocClient();
  await client.send(new PutCommand({ TableName: TABLE, Item: item }));
};

const updateProgress = async (userId, lessonId, updates) => {
  const client = getDynamoDocClient();
  const expressions = [];
  const attrNames = {};
  const attrValues = {};

  Object.entries(updates).forEach(([key, value], i) => {
    const nameKey = `#f${i}`;
    const valueKey = `:v${i}`;
    expressions.push(`${nameKey} = ${valueKey}`);
    attrNames[nameKey] = key;
    attrValues[valueKey] = value;
  });

  await client.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { userId, lessonId },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
    }),
  );
};

const queryByUser = async (userId) => {
  const client = getDynamoDocClient();
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );
  return result.Items || [];
};

// Reads every progress record across the whole table for a fixed set of lesson
// IDs. Uses Scan + FilterExpression — fine at pilot scale (≤30 learners,
// ≤ a few hundred items). If the table grows past low thousands, swap for a
// GSI on `lessonId` and replace this with a Query per lesson.
const scanByLessonIds = async (lessonIds) => {
  if (!lessonIds || lessonIds.length === 0) return [];
  const client = getDynamoDocClient();
  const placeholders = lessonIds.map((_, i) => `:l${i}`);
  const values = Object.fromEntries(lessonIds.map((id, i) => [`:l${i}`, id]));
  const result = await client.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: `lessonId IN (${placeholders.join(', ')})`,
      ExpressionAttributeValues: values,
    }),
  );
  return result.Items || [];
};

module.exports = { getProgress, putProgress, updateProgress, queryByUser, scanByLessonIds };
