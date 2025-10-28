const path = require('path');
const Book = require("../models/Book");
const User = require("../models/User");
const Course = require("../models/Course");
const { generatePresignedUrl, generateGetPresignedUrl, deleteObject } = require("../utils/r2");

// Get presigned URL for cover image upload
const getuploadurl = async (req, res) => {
    try {
      const user = req.user;
      console.log(user.businessName)
      const { fileName, contentType } = req.body;
      
      if (!fileName || !contentType) {
        return res.status(400).json({ 
          success: false, 
          message: 'File name and content type are required' 
        });
      }
  
      // Create unique filename with timestamp
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(fileName);
      const key = `${user.businessName}/courses/course-${uniqueSuffix}${ext}`;
  
      // Generate presigned URL
      const uploadUrl = await generatePresignedUrl(key, contentType);
  
      return res.status(200).json({
        success: true,
        uploadUrl,
        key
      });
    } catch (error) {
      console.error('Get cover image upload URL error:', error);
      return res.status(500).json({ success: false, message: 'Server Error' });
    }
};

const createcourse = async (req, res) => {
  try {
    const { name, overview, details, cover_imageKey, faculty } = req.body;
    const { bookId } = req.params;
    console.log(req.body);
    // Optional: Check if the book exists
    const book = await Book.findById(bookId);
    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }

    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const cover_imageUrl = await generateGetPresignedUrl(cover_imageKey);

    // Process each faculty member
    const processedFaculty = await Promise.all(
      (faculty || []).map(async (fac) => ({
        ...fac,
        faculty_imageUrl: fac.faculty_imageKey
          ? await generateGetPresignedUrl(fac.faculty_imageKey)
          : undefined,
      }))
    );

    const course = await Course.create({
      name,
      overview,
      details,
      cover_imageKey,
      cover_imageUrl,
      faculty: processedFaculty,
      bookId,
    });
    book.isVideoAvailabel = true;
    await book.save();

    res.status(200).json({
      success: true,
      message: "course created successfully",
      courseId: course[0]?._id || "",
      course,
      isVideoAvailabel: book.isVideoAvailabel || ""
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

const getcourses = async (req, res) => {
  try {
    const { bookId } = req.params;
    // Optional: Check if the book exists
    const book = await Book.findById(bookId);
    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }
    
    const course = await Course.find({bookId});

    await Promise.all(course.map(async (course) => {
      if(course.cover_imageKey){
        course.cover_imageUrl = await generateGetPresignedUrl(course.cover_imageKey);
      }
      if(course.faculty){
        await Promise.all(course.faculty.map(async (fac) => {
          if(fac.faculty_imageKey){
            fac.faculty_imageUrl = await generateGetPresignedUrl(fac.faculty_imageKey);
          }
        }));
      }
    }));


    if(course.length === 0)
    {
      return res
      .status(200)
      .json({success:true, message:`Course not found in this Book ${bookId}`})
    }

    res.status(200).json({
        success:true,
        message:"course retrieved successfully",
        courseId: course[0]?._id || "",
        course: course      
    })
  } catch (error) {
    console.log(error)
  }
};

const updatecourse = async (req, res) => {
    try {
        const { bookId, courseId } = req.params;
        const { name, overview, details, cover_imageKey, faculty } = req.body;

        // Optional: Check if the book exists
        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ success: false, message: "Book not found" });
        }
        // Find and update the course
        const course = await Course.findById(courseId);

        if (!course) {
            return res.status(404).json({ success: false, message: "Course not found" });
        }
        let imageUrl = course.cover_imageUrl;
        let imageKey = course.cover_imageKey;

        if(cover_imageKey && cover_imageKey !== course.cover_imageKey){
          if(course.cover_imageKey)
            {
              await deleteObject(course.cover_imageKey);
            }  
            imageUrl = await generateGetPresignedUrl(cover_imageKey)
            imageKey = cover_imageKey;
        }

        // Process each faculty member, matching by name
        const processedFaculty = await Promise.all(
          (faculty || []).map(async (fac) => {
            // Match by name instead of _id
            let oldFac = course.faculty.find(f => f.name === fac.name);
            let faculty_imageKey = fac.faculty_imageKey;
            let faculty_imageUrl = fac.faculty_imageUrl;

            if (oldFac) {
              // If image key changed, delete old and generate new URL
              if (fac.faculty_imageKey && fac.faculty_imageKey !== oldFac.faculty_imageKey) {
                if (oldFac.faculty_imageKey) {
                  await deleteObject(oldFac.faculty_imageKey);
                }
                faculty_imageUrl = await generateGetPresignedUrl(fac.faculty_imageKey);
              } else {
                // Not changed, keep old
                faculty_imageKey = oldFac.faculty_imageKey;
                faculty_imageUrl = oldFac.faculty_imageUrl;
              }
            } else if (fac.faculty_imageKey) {
              // New faculty, generate URL if key provided
              faculty_imageUrl = await generateGetPresignedUrl(fac.faculty_imageKey);
            }

            return {
              ...fac,
              faculty_imageKey,
              faculty_imageUrl,
            };
          })
        );

        course.name = name;
        course.overview = overview;
        course.details = details;
        course.cover_imageKey = imageKey;
        course.cover_imageUrl = imageUrl;
        course.faculty = processedFaculty;
        await course.save();

        res.status(200).json({
            success: true,
            message: "Course updated successfully",
            courseId: course[0]?._id || "",
            course: course,
            isVideoAvailabel: book.isVideoAvailabel
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Server error" });
    }
}

const deletecourse = async (req,res) =>
    {
        try {
            const { bookId } = req.params;
            const { courseId } = req.params;
            // Optional: Check if the book exists
            const book = await Book.findById(bookId);
            if (!book) {
              return res
                .status(404)
                .json({ success: false, message: "Book not found" });
            }
            const course = await Course.findById(courseId) ;
            if(!course){
                return res
                .status(404)
                .json({ success: false, message: "Course not found" });
            }
            if(course.cover_imageKey && course.cover_imageUrl){
                await deleteObject(course.cover_imageKey);
            }
            if(course.faculty.faculty_imageKey && course.faculty.faculty_imageUrl){
                await deleteObject(course.faculty.faculty_imageKey);
            }
            await course.deleteOne();
            res.status(200).json({
                success:true,
                message:"course deleted successfully",
                courseId: course[0]?._id || "",
                course:course
            })
        } 
        catch (error) {
          console.log(error);
          res.status(500).json({ success: false, message: "Server error" });        }
    }
module.exports = { createcourse, getcourses, deletecourse, updatecourse, getuploadurl };
