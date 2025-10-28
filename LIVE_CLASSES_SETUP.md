# Live Classes Setup Guide (100ms Integration)

## Overview
This implementation adds live class functionality using 100ms.live video conferencing platform.

## Architecture

### Flow
1. **Admin Side**: Admin creates classrooms → creates classes → 100ms room is created
2. **Student Side**: Student views available classes → clicks join → receives token → joins via 100ms SDK

## Setup Instructions

### 1. Backend Configuration

Add these environment variables to your `.env` file:

```env
# 100ms Configuration
HMS_APP_ID=your_100ms_app_id
HMS_APP_SECRET=your_100ms_app_secret
```

To get your 100ms credentials:
1. Sign up at https://100ms.live
2. Create a new app in your dashboard
3. Copy the App ID and App Secret from your app settings

### 2. Database Models

Two new models have been created:
- **Classroom**: Container for multiple classes
- **Class**: Individual live class session

### 3. API Endpoints

#### Admin Endpoints (Protected by verifyAdminToken)
- `POST /api/live-classes/admin/classrooms` - Create classroom
- `GET /api/live-classes/admin/classrooms` - Get all classrooms
- `POST /api/live-classes/admin/classes` - Create class
- `GET /api/live-classes/admin/classrooms/:classroomId/classes` - Get classes in classroom
- `PATCH /api/live-classes/admin/classes/:classId/status` - Update class status
- `GET /api/live-classes/admin/classes/:classId/attendance` - Get class attendance

#### Student Endpoints
- `GET /api/live-classes/classes?status=scheduled,live` - Get available classes
- `POST /api/live-classes/classes/:classId/join` - Join class (generates token)
- `POST /api/live-classes/classes/:classId/leave` - Leave class (logs attendance)

### 4. Frontend Components

**Admin Side:**
- `ClassroomManagement.jsx` - Manage classrooms and classes
- Route: `/admin/live-classes`

**Student Side:**
- `StudentLiveClasses.jsx` - View and join classes
- `LiveClassRoom.jsx` - Video room interface using 100ms SDK

### 5. How to Use

#### Admin Flow:

1. **Navigate to Live Classes**
   - Go to `/admin/live-classes` in your admin dashboard
   
2. **Create a Classroom**
   - Click "Create Classroom"
   - Enter name and description
   - Click "Create"

3. **Create a Class**
   - Click "View Classes" on a classroom
   - Click "Add Class"
   - Fill in:
     - Class Title
     - Description
     - Scheduled Date & Time
     - Duration (in minutes)
   - Click "Create"
   - A 100ms room will be automatically created

#### Student Flow:

1. **View Available Classes**
   - Navigate to the student interface
   - View "Live Classes" section
   - See all scheduled and live classes

2. **Join a Class**
   - Click "Join Class" or "Join Now" on a live class
   - A token will be generated
   - The 100ms video room will open
   - Toggle camera/mic as needed
   - Leave when done

### 6. Features

- ✅ Classroom and Class management
- ✅ 100ms room creation
- ✅ Automatic attendance tracking
- ✅ Token-based secure joining
- ✅ Real-time video conferencing
- ✅ Camera/mic controls
- ✅ Attendance statistics

### 7. Testing

1. Start your backend server
2. Navigate to admin dashboard
3. Create a test classroom and class
4. Open student interface
5. Join the class
6. Test video/audio controls

### 8. Troubleshooting

**Issue**: "100ms credentials not configured"
- Make sure you've added HMS_APP_ID and HMS_APP_SECRET to your .env file

**Issue**: Classes not appearing
- Check if the class status is 'scheduled' or 'live'
- Verify the scheduled time hasn't passed

**Issue**: Can't join class
- Check if room was successfully created in 100ms dashboard
- Verify token generation is working
- Check browser console for errors

### 9. Next Steps

Optional enhancements:
- [ ] Add recording functionality
- [ ] Add chat feature during class
- [ ] Add screen sharing
- [ ] Add polls/quizzes
- [ ] Add breakout rooms
- [ ] Send notifications before class starts
- [ ] Add class recordings playback
- [ ] Add attendance reports download

