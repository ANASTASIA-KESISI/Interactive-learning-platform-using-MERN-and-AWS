const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { env } = require('./env');

let dynamoDoc;
let s3;
let cognito;

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

// Used only by the admin role-management path. Requires the backend IAM
// identity to hold cognito-idp:AdminAddUserToGroup, AdminRemoveUserFromGroup
// and AdminListGroupsForUser on the user pool.
const getCognitoClient = () => {
  if (!cognito) {
    cognito = new CognitoIdentityProviderClient({ region: env.aws.region });
  }
  return cognito;
};

module.exports = { getDynamoDocClient, getS3Client, getCognitoClient };
