// utils/r2.js
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET_NAME'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required AWS environment variables:', missingEnvVars);
  process.exit(1);
}

const s3Client = new S3Client({
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    region: "auto",
    // when_required prevents SDK v3 from adding X-Amz-Checksum-Algorithm to presigned URLs
    // which Cloudflare R2 cannot fulfill from browser PUT requests
    requestChecksumCalculation: 'when_required',
    responseChecksumValidation: 'when_required',
});

// Generate presigned URL for uploading
const generatePresignedUrl = async (key, contentType) => {
  try {
    console.log('Generating presigned URL for:', { key, contentType });
    
    // Ensure the key is properly formatted
    const formattedKey = key.startsWith('/') ? key.slice(1) : key;
    console.log('Formatted key:', formattedKey);
    
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: formattedKey,
    });

    console.log('Created PutObjectCommand with params:', {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: formattedKey,
    });

    // Generate presigned URL with 1 hour expiration
    const url = await getSignedUrl(s3Client, command, { 
      expiresIn: 604800,
    });

    console.log('Successfully generated presigned URL');
    console.log('FULL PRESIGNED URL (for diagnosis):', url);
    return url;
  } catch (error) {
    console.error('Error generating presigned URL:', {
      error: error.message,
      code: error.code,
      key: key,
      bucket: process.env.R2_BUCKET_NAME,
      region: process.env.R2_REGION,
      stack: error.stack
    });
    throw error;
  }
};

// Generate presigned URL for getting/reading an object
const generateGetPresignedUrl = async (key, expiresIn = 604800) => { // Default 7 days (max allowed)
  try {
    if (process.env.R2_PUBLIC_URL) {
      const formattedKey = key.startsWith('/') ? key.slice(1) : key;
      return `${process.env.R2_PUBLIC_URL}/${formattedKey}`;
    }

    console.log('Generating presigned URL for key:', key);
    console.log('Using bucket:', process.env.R2_BUCKET_NAME);
    console.log('Using region:', process.env.R2_REGION);

    // Ensure the key is properly formatted
    const formattedKey = key.startsWith('/') ? key.slice(1) : key;
    console.log('Formatted key:', formattedKey);

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: formattedKey,
    });

    console.log('Created GetObjectCommand with params:', {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: formattedKey
    });

    // Generate URL with valid expiration (max 7 days)
    const signedUrl = await getSignedUrl(s3Client, command, { 
      expiresIn: Math.min(expiresIn, 604800) // Ensure we don't exceed 7 days
    });

    console.log('Successfully generated presigned URL');
    return signedUrl;
  } catch (error) {
    console.error('Error generating get presigned URL:', {
      error: error.message,
      code: error.code,
      key: key,
      bucket: process.env.R2_BUCKET_NAME,
      region: process.env.R2_REGION,
      stack: error.stack
    });
    throw error;
  }
};

// Generate presigned URL for annotated images (long-lived)
const generateAnnotatedImageUrl = async (key) => {
  try {
    console.log('Generating annotated image URL for key:', key);
    console.log('Using bucket:', process.env.AWS_BUCKET_NAME);
    console.log('Using region:', process.env.AWS_REGION);

    // Ensure the key is properly formatted
    const formattedKey = key.startsWith('/') ? key.slice(1) : key;
    console.log('Formatted key:', formattedKey);

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: formattedKey,
    });

    console.log('Created GetObjectCommand with params:', {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: formattedKey
    });

    // Generate URL with 1 year expiration
    const signedUrl = await getSignedUrl(s3Client, command, { 
      expiresIn: 604800 
    });

    console.log('Successfully generated annotated image URL');
    console.log(signedUrl)
    return signedUrl;
  } catch (error) {
    console.error('Error generating annotated image URL:', {
      error: error.message,
      code: error.code,
      key: key,
      bucket: process.env.R2_BUCKET_NAME,
      region: process.env.R2_REGION,
      stack: error.stack
    });
    throw error;
  }
};

const deleteObject = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting object:', error);
    throw error;
  }
};

const uploadFileToS3 = async (buffer, key, contentType) => {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await s3Client.send(command);
  return key;
};

module.exports = {
  s3Client,
  generatePresignedUrl,
  generateGetPresignedUrl,
  generateAnnotatedImageUrl,
  deleteObject,
  uploadFileToS3
};