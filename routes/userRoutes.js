const express = require("express")
const { protect } = require("../middleware/authMiddleware")
const User = require('../models/User')

const router = express.Router()

// Protect all routes
router.use(protect)

// Get user profile
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password')
    res.json(user)
  } catch (error) {
    res.status(500).json({ message: 'Server error' })
  }
})

// Add movie to favorites
router.post('/favorites', protect, async (req, res) => {
  try {
    const { title, path, thumbnailUrl } = req.body
    
    if (!title || !path) {
      return res.status(400).json({ message: 'Title and path are required' })
    }
    
    const user = await User.findById(req.user._id)
    
    // Check if movie already exists in favorites
    const existingFavorite = user.favorites.find(fav => fav.path === path)
    if (existingFavorite) {
      return res.status(400).json({ message: 'Movie already in favorites' })
    }
    
    user.favorites.push({
      title,
      path,
      thumbnailUrl,
      addedAt: new Date()
    })
    
    await user.save()
    res.status(201).json(user.favorites)
  } catch (error) {
    console.error('Add favorite error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Remove movie from favorites
router.delete('/favorites/:favId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    
    user.favorites = user.favorites.filter(fav => fav._id.toString() !== req.params.favId)
    
    await user.save()
    res.json(user.favorites)
  } catch (error) {
    console.error('Remove favorite error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Get user's watch history
router.get('/history', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    res.json(user.watchHistory.sort((a, b) => b.watchedAt - a.watchedAt))
  } catch (error) {
    console.error('Get history error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Add entry to watch history
router.post('/history', protect, async (req, res) => {
  try {
    const { roomId, movieTitle, moviePath, duration, watchedDuration } = req.body
    
    if (!movieTitle || !moviePath) {
      return res.status(400).json({ message: 'Movie title and path are required' })
    }
    
    const user = await User.findById(req.user._id)
    
    user.watchHistory.push({
      roomId,
      movieTitle,
      moviePath,
      watchedAt: new Date(),
      duration,
      watchedDuration
    })
    
    // Limit history to 50 items
    if (user.watchHistory.length > 50) {
      user.watchHistory = user.watchHistory.slice(-50)
    }
    
    await user.save()
    res.status(201).json(user.watchHistory)
  } catch (error) {
    console.error('Add history error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Add a friend
router.post('/friends/:friendId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    const friendId = req.params.friendId
    
    // Check if friend exists
    const friend = await User.findById(friendId)
    if (!friend) {
      return res.status(404).json({ message: 'User not found' })
    }
    
    // Check if already friends
    if (user.friends.includes(friendId)) {
      return res.status(400).json({ message: 'Already friends with this user' })
    }
    
    user.friends.push(friendId)
    await user.save()
    
    res.status(201).json(user.friends)
  } catch (error) {
    console.error('Add friend error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

module.exports = router
