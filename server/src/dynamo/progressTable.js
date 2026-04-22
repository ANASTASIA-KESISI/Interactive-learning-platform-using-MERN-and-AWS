const { GetCommand, PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
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

module.exports = { getProgress, putProgress, updateProgress, queryByUser };
