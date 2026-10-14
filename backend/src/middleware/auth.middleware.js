const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_VERIFY_OPTIONS } = require('../config/jwt');

const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Connecte-toi pour continuer' });
    }

    const token = authHeader.split('Bearer ')[1];
    
    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS);
    
    // Attach user info to request
    req.user = {
      uid: decoded.userId,
      email: decoded.email
    };
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Session invalide : reconnecte-toi' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée : reconnecte-toi' });
    }
    
    res.status(401).json({ error: 'Session invalide : reconnecte-toi' });
  }
};

module.exports = { authenticateUser };
