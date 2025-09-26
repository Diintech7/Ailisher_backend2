// utils/s3.js
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_BUCKET_NAME'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required AWS environment variables:', missingEnvVars);
  process.exit(1);
}

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Generate presigned URL for uploading
const generatePresignedUrl = async (key, contentType) => {
  try {
    console.log('Generating presigned URL for:', { key, contentType });
    
    // Ensure the key is properly formatted
    const formattedKey = key.startsWith('/') ? key.slice(1) : key;
    console.log('Formatted key:', formattedKey);
    
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: formattedKey,
      ContentType: contentType
    });

    // console.log('Created PutObjectCommand with params:', {
    //   Bucket: process.env.AWS_BUCKET_NAME,
    //   Key: formattedKey,
    //   ContentType: contentType
    // });

    // Generate presigned URL with 1 hour expiration
    const url = await getSignedUrl(s3Client, command, { 
      expiresIn: 604800 
    });

    // console.log('Successfully generated presigned URL');
    return url;
  } catch (error) {
    console.error('Error generating presigned URL:', {
      error: error.message,
      code: error.code,
      key: key,
      bucket: process.env.AWS_BUCKET_NAME,
      region: process.env.AWS_REGION,
      stack: error.stack
    });
    throw error;
  }
};

// Generate presigned URL for getting/reading an object
const generateGetPresignedUrl = async (key, expiresIn = 604800) => { // Default 7 days (max allowed)
  try {
    // console.log('Generating presigned URL for key:', key);
    // console.log('Using bucket:', process.env.AWS_BUCKET_NAME);
    // console.log('Using region:', process.env.AWS_REGION);

    // Ensure the key is properly formatted
    const formattedKey = key.startsWith('/') ? key.slice(1) : key;
    // console.log('Formatted key:', formattedKey);

    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: formattedKey,
    });

    // console.log('Created GetObjectCommand with params:', {
    //   Bucket: process.env.AWS_BUCKET_NAME,
    //   Key: formattedKey
    // });

    // Generate URL with valid expiration (max 7 days)
    const signedUrl = await getSignedUrl(s3Client, command, { 
      expiresIn: Math.min(expiresIn, 604800) // Ensure we don't exceed 7 days
    });

    // console.log('Successfully generated presigned URL');
    return signedUrl;
  } catch (error) {
    console.error('Error generating get presigned URL:', {
      error: error.message,
      code: error.code,
      key: key,
      bucket: process.env.AWS_BUCKET_NAME,
      region: process.env.AWS_REGION,
      stack: error.stack
    });
    throw error;
  }
};

const deleteObject = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting object:', error);
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
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: formattedKey,
    });

    console.log('Created GetObjectCommand with params:', {
      Bucket: process.env.AWS_BUCKET_NAME,
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
      bucket: process.env.AWS_BUCKET_NAME,
      region: process.env.AWS_REGION,
      stack: error.stack
    });
    throw error;
  }
};

// Add URL refresh function
const refreshAnnotatedImageUrls = async (userAnswer) => {
  if (userAnswer.feedback?.expertReview?.annotatedImages) {
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 604800); 

    for (let image of userAnswer.feedback.expertReview.annotatedImages) {
      // Refresh URL if it's older than 1 year
      if (!image.uploadedAt || new Date(image.uploadedAt) < oneYearAgo) {
        try {
          const newUrl = await generateAnnotatedImageUrl(image.s3Key);
          image.downloadUrl = newUrl;
          image.uploadedAt = now;
        } catch (error) {
          console.error('Error refreshing URL for image:', image.s3Key, error);
        }
      }
    }
  }
  return userAnswer;
};

const uploadFileToS3 = async (buffer, key, contentType) => {
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
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
  refreshAnnotatedImageUrls,
  deleteObject,
  uploadFileToS3,
};