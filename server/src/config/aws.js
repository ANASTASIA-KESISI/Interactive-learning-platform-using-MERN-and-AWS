const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { env } = require('./env');

let dynamoDoc;
let s3;

const getDynamoDocClient = () => {
  if (!dynamoDoc) {
    const base = new DynamoDBClient({ region: env.aws.region });
    dynamoDoc = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return dynamoDoc;
};

const getS3Client = () => {
  if (!s3) {
    s3 = new S3Client({ region: env.aws.region });
  }
  return s3;
};

module.exports = { getDynamoDocClient, getS3Client };
