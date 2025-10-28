const axios = require('axios');

class HMS100Service {
  constructor() {
    this.appId = process.env.HMS_APP_ID;
    this.appSecret = process.env.HMS_APP_SECRET;
    this.baseURL = 'https://api.100ms.live/v2';
    
    if (!this.appId || !this.appSecret) {
      console.warn('⚠️  100ms credentials not configured');
    }
  }

  /**
   * Generate authentication token
   */
  async generateToken(roomId, userId, role = 'guest') {
    try {
      const tokenEndpoint = `${this.baseURL}/sessions/token`;
      
      const response = await axios.post(tokenEndpoint, {
        room_id: roomId,
        user_id: userId,
        role: role
      }, {
        headers: {
          'Authorization': `Bearer ${this.appSecret}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data.token;
    } catch (error) {
      console.error('Error generating 100ms token:', error.response?.data || error.message);
      throw new Error('Failed to generate 100ms token');
    }
  }

  /**
   * Create a room in 100ms
   */
  async createRoom(name, description = '') {
    try {
      const endpoint = `${this.baseURL}/rooms`;
      
      const response = await axios.post(endpoint, {
        name: name,
        description: description,
        region: 'us'
      }, {
        headers: {
          'Authorization': `Bearer ${this.appSecret}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        roomId: response.data.id,
        roomCode: response.data.enabled_room_codes[0] || null
      };
    } catch (error) {
      console.error('Error creating 100ms room:', error.response?.data || error.message);
      throw new Error('Failed to create 100ms room');
    }
  }

  /**
   * Get room details
   */
  async getRoom(roomId) {
    try {
      const endpoint = `${this.baseURL}/rooms/${roomId}`;
      
      const response = await axios.get(endpoint, {
        headers: {
          'Authorization': `Bearer ${this.appSecret}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error getting 100ms room:', error.response?.data || error.message);
      throw new Error('Failed to get room details');
    }
  }

  /**
   * List active rooms
   */
  async listRooms() {
    try {
      const endpoint = `${this.baseURL}/rooms`;
      
      const response = await axios.get(endpoint, {
        headers: {
          'Authorization': `Bearer ${this.appSecret}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error listing 100ms rooms:', error.response?.data || error.message);
      throw new Error('Failed to list rooms');
    }
  }

  /**
   * Get room session
   */
  async getSession(roomId) {
    try {
      const endpoint = `${this.baseURL}/sessions/active`;
      
      const response = await axios.get(endpoint, {
        params: { room_id: roomId },
        headers: {
          'Authorization': `Bearer ${this.appSecret}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error getting 100ms session:', error.response?.data || error.message);
      throw new Error('Failed to get session');
    }
  }
}

module.exports = new HMS100Service();

